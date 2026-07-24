import { stripWritingNoise, countSentences, countParagraphs } from "./text-metrics.js";

/* Analyse narrative — Phase 1 : socle de métriques FR-safe, sans NLP (voir la
 * feuille de route Analyse). Fonctions PURES, testables sans Obsidian, pour
 * servir de base aux phases suivantes (répétitions, courbe narrative,
 * lemme/POS via Grammalecte). */

const LONG_SENTENCE_WORDS = 40;

/** Tokens « mots » d'un fragment déjà nettoyé (même définition que countWords :
 * un token comptant au moins une lettre/chiffre). */
function wordTokens(text) {
  return text
    .replace(/[#>*_`~=[\]()]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/** Découpe en phrases (terminateurs . ! ? …), fragments non vides. */
function splitSentences(text) {
  return (text.match(/[^.!?…]+[.!?…]+/g) || []).map((s) => s.trim()).filter(Boolean);
}

/** Un paragraphe est considéré « dialogue » s'il ouvre par un tiret de
 * dialogue (— – -) ou contient des guillemets. Heuristique (pas du NLP) —
 * suffisante pour un ratio indicatif. */
function isDialogueParagraph(p) {
  const s = p.trimStart();
  return /^[—–-]/.test(s) || /[«»""]/.test(p);
}

/** Métriques d'un texte de prose. Retourne des valeurs BRUTES (pas de score
 * composite) : mots, phrases, paragraphes, longueurs moyennes, phrases
 * longues (>40 mots) et ratio dialogue (part des mots dans des paragraphes de
 * dialogue). `longSentences` liste les phrases concernées pour une future
 * navigation. */
export function analyzeProse(rawText) {
  const clean = stripWritingNoise(rawText || "");
  const tokensAll = wordTokens(clean);
  const words = tokensAll.length;
  const sentences = countSentences(clean);
  const paragraphs = countParagraphs(clean);

  const avgSentenceLength = sentences ? words / sentences : 0;

  const letters = tokensAll.reduce(
    (n, w) => n + [...w].filter((c) => /\p{L}/u.test(c)).length,
    0
  );
  const avgWordLength = tokensAll.length ? letters / tokensAll.length : 0;

  const longSentences = splitSentences(clean).filter(
    (s) => wordTokens(s).length > LONG_SENTENCE_WORDS
  );

  const paras = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let dialogueWords = 0;
  let paraWords = 0;
  for (const p of paras) {
    const n = wordTokens(p).length;
    paraWords += n;
    if (isDialogueParagraph(p)) dialogueWords += n;
  }
  const dialogueRatio = paraWords ? dialogueWords / paraWords : 0;

  return {
    words,
    sentences,
    paragraphs,
    avgSentenceLength,
    avgWordLength,
    longSentenceCount: longSentences.length,
    longSentences,
    dialogueRatio,
  };
}
