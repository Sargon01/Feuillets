/**
 * Importateur de chronologie — moteur PUR (sans dépendance à Obsidian) qui
 * découpe un document Markdown de chronologie en fiches individuelles.
 *
 * Format PRINCIPAL attendu (voir la commande "Extraire et éclater…",
 * main.ts) :
 *
 *   # Chronologie
 *
 *   ## Départ de la caravane dans le Hedjaz
 *
 *   ### 12 mars 765
 *
 *   Description longue et libre…
 *
 *   ## Séisme de Lisbonne
 *
 *   ### 1er novembre 1755 à 9 h 30
 *
 *   Description longue et libre…
 *
 * Chaque `##` est une fiche : son titre devient `title`, le PREMIER `###`
 * qui suit devient `date` (conservée telle quelle — texte français naturel
 * ou ISO, les deux sont exploitables tels quels par parseFlexibleDate, voir
 * utils/natural-date.ts — et VALIDÉE avec ce même parseur partagé), et tout
 * le texte après ce `###` devient la description. Aucune propriété `type`
 * n'est jamais déduite ni requise — seul le tag historique `evenement` est
 * ajouté automatiquement (voir main.ts), pour un résultat homogène avec
 * l'ancien format.
 *
 * Repli COMPATIBLE avec l'ancien format à un seul niveau de titre daté
 * (`## AAAA[-MM[-JJ]] - Titre` ou `### …`) : détecté par la présence d'au
 * moins UN titre `##`/`###` commençant directement par une date au format
 * numérique — dans ce cas, le document ENTIER est traité à l'ancien format
 * (jamais mélangé avec le nouveau).
 *
 * AUCUNE création partielle : un document mal formé (bloc `##` sans `###`,
 * ou `###` qui n'est pas une date reconnue) fait échouer l'import ENTIER —
 * voir ChronologyImportResult, jamais un bloc silencieusement ignoré.
 */

import { parseFlexibleDate } from "../utils/natural-date.js";

export interface ChronologyImportBlock {
  title: string;
  date: string;
  text: string;
}

export interface ChronologyProjectionBlock extends ChronologyImportBlock {
  sourceStart: number;
  sourceEnd: number;
}

export interface ChronologyImportError {
  /** Titre du bloc `##` fautif (ou la date elle-même en repli, ancien
   * format, si aucun titre n'a pu en être extrait) — toujours affichable
   * tel quel dans une Notice utilisateur. */
  title: string;
  reason: "missing-date" | "invalid-date";
}

export type ChronologyImportResult =
  | { ok: true; blocks: ChronologyImportBlock[] }
  | { ok: false; error: ChronologyImportError };

export type ChronologyProjectionResult =
  | { ok: true; blocks: ChronologyProjectionBlock[] }
  | { ok: false; error: ChronologyImportError };

/** Signature d'un titre `##` à l'ANCIEN format : commence directement par
 * une date numérique (`## 1755-11-01 - Titre`). Restreinte au niveau `##`
 * UNIQUEMENT — un `###` commençant par un chiffre est, au contraire, le
 * signe le plus probable du NOUVEAU format (son sous-titre daté, ex.
 * `### 12 mars 765`) : le tester aussi aurait fait passer un document
 * parfaitement au nouveau format pour de l'ancien, dès son premier
 * événement. */
const LEGACY_H2_HEAD_RE = /^##[ \t]+(\d{1,4}(?:-\d{1,2}(?:-\d{1,2})?)?)/m;

/** Signature de repli pour un document à l'ancien format qui n'utiliserait
 * QUE des titres `###` (jamais `##`) — seulement testée quand le document
 * ne contient absolument aucun `##`, pour ne jamais interférer avec la
 * détection du nouveau format ci-dessus. */
const LEGACY_H3_ONLY_HEAD_RE = /^###[ \t]+(\d{1,4}(?:-\d{1,2}(?:-\d{1,2})?)?)/m;
const HAS_H2_RE = /^##[ \t]+/m;

/** Découpe le corps (frontmatter déjà retiré) en blocs `##` avec leurs
 * bornes [start, end) de contenu (juste après le titre jusqu'au `##`
 * suivant, ou la fin du document). */
function splitByH2(body: string): Array<{ title: string; start: number; end: number; sourceStart: number }> {
  const h2Re = /^##[ \t]+(.+)$/gm;
  const blocks: Array<{ title: string; start: number; end: number; sourceStart: number }> = [];
  let last: { title: string; start: number; end: number; sourceStart: number } | null = null;
  let hm: RegExpExecArray | null;
  while ((hm = h2Re.exec(body)) !== null) {
    if (last) last.end = hm.index;
    last = { title: hm[1].trim(), start: h2Re.lastIndex, end: body.length, sourceStart: hm.index };
    blocks.push(last);
  }
  return blocks;
}

/** Ancien format à un seul niveau de titre daté — comportement HISTORIQUE
 * inchangé : `## AAAA[-MM[-JJ]] - Titre` (ou `###`), le texte qui suit
 * devient la description. */
type ParsedChronologyBlock = ChronologyImportBlock & { sourceStart: number; sourceEnd: number };

function parseLegacyFormat(body: string): ParsedChronologyBlock[] {
  const headRe = /^(#{2,3})\s+(\d{1,4}(?:-\d{1,2}(?:-\d{1,2})?)?)\s*[-–—:]?\s*(.*)$/gm;
  type Block = { date: string; title: string; start: number; end: number; sourceStart: number };
  const blocks: Block[] = [];
  let last: Block | null = null;
  let m: RegExpExecArray | null;
  while ((m = headRe.exec(body)) !== null) {
    if (last) last.end = m.index;
    last = { date: m[2], title: m[3].trim() || m[2], start: headRe.lastIndex, end: body.length, sourceStart: m.index };
    blocks.push(last);
  }
  return blocks.map((b) => ({ date: b.date, title: b.title, text: body.slice(b.start, b.end).trim(), sourceStart: b.sourceStart, sourceEnd: b.end }));
}

function parseChronologyBlocks(body: string): { ok: true; blocks: ParsedChronologyBlock[] } | { ok: false; error: ChronologyImportError } {
  const hasH2 = HAS_H2_RE.test(body);
  const looksLegacy = LEGACY_H2_HEAD_RE.test(body) || (!hasH2 && LEGACY_H3_ONLY_HEAD_RE.test(body));
  if (looksLegacy) {
    const legacyBlocks = parseLegacyFormat(body);
    for (const block of legacyBlocks) {
      if (!parseFlexibleDate(block.date)) {
        return { ok: false, error: { title: block.title || block.date, reason: "invalid-date" } };
      }
    }
    return { ok: true, blocks: legacyBlocks };
  }

  const h2Blocks = splitByH2(body);
  const blocks: ParsedChronologyBlock[] = [];
  for (const block of h2Blocks) {
    const section = body.slice(block.start, block.end);
    const h3Re = /^###[ \t]+(.+)$/m;
    const h3Match = h3Re.exec(section);
    if (!h3Match || h3Match.index === undefined) {
      return { ok: false, error: { title: block.title, reason: "missing-date" } };
    }
    const date = h3Match[1].trim();
    if (!parseFlexibleDate(date)) {
      return { ok: false, error: { title: block.title, reason: "invalid-date" } };
    }
    const textStart = h3Match.index + h3Match[0].length;
    blocks.push({
      title: block.title,
      date,
      text: section.slice(textStart).trim(),
      sourceStart: block.sourceStart,
      sourceEnd: block.end,
    });
  }
  return { ok: true, blocks };
}

function initialFrontmatterEnd(source: string): number {
  const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(source);
  return match ? match[0].length : 0;
}

/**
 * Analyse un document de chronologie et retourne soit la liste complète des
 * fiches (`ok: true`), soit l'erreur du PREMIER bloc fautif rencontré
 * (`ok: false`) — jamais une création partielle : l'appelant (main.ts) doit
 * interrompre l'import entier et informer l'auteur du titre concerné.
 */
export function parseChronologyImport(body: string): ChronologyImportResult {
  const result = parseChronologyBlocks(body);
  if (!result.ok) return result;
  return { ok: true, blocks: result.blocks.map(({ title, date, text }) => ({ title, date, text })) };
}

export function parseChronologyProjection(source: string): ChronologyProjectionResult {
  const frontmatterEnd = initialFrontmatterEnd(source);
  const body = source.slice(frontmatterEnd);
  const result = parseChronologyBlocks(body);
  if (!result.ok) return result;
  return {
    ok: true,
    blocks: result.blocks.map((block) => ({
      title: block.title,
      date: block.date,
      text: block.text,
      sourceStart: block.sourceStart + frontmatterEnd,
      sourceEnd: block.sourceEnd + frontmatterEnd,
    })),
  };
}
