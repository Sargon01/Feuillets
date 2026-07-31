import { stripWritingNoise, countSentences, countParagraphs } from "./text-metrics.js";

/* Analyse narrative — Phase 1 : socle de métriques FR-safe, sans NLP (voir la
 * feuille de route Analyse). Fonctions PURES, testables sans Obsidian, pour
 * servir de base aux phases suivantes (répétitions, courbe narrative,
 * lemme/POS via Grammalecte). */

const LONG_SENTENCE_WORDS = 40;

/** Tokens « mots » d'un fragment déjà nettoyé (même définition que countWords :
 * un token comptant au moins une lettre/chiffre). */
function wordTokens(text: string) {
  return text
    .replace(/[#>*_`~=[\]()]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/** Découpe en phrases (terminateurs . ! ? …), fragments non vides. */
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?…]+[.!?…]+/g) || [];
  return matches.map((s: string) => s.trim()).filter(Boolean);
}

/** Lignes de structure Markdown, jamais de la prose ni du dialogue : titre
 * (dièse), liste à puces (y compris case à cocher « - [ ] »), liste
 * numérotée, citation (chevron), ou ligne de séparation (trois tirets,
 * astérisques ou underscores). Vérifiée sur la PREMIÈRE ligne du
 * paragraphe — un bloc de liste multi-lignes (pas de ligne vide entre les
 * puces) reste donc entièrement exclu du dialogue par ce seul test, sans
 * avoir à examiner chaque ligne. */
const MARKDOWN_STRUCTURAL_RE = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?)/;
const HORIZONTAL_RULE_RE = /^(-{3,}|\*{3,}|_{3,})$/;

function isStructuralParagraph(p: string): boolean {
  const firstLine = p.trimStart().split("\n", 1)[0].trim();
  if (!firstLine) return true;
  if (HORIZONTAL_RULE_RE.test(firstLine)) return true;
  return MARKDOWN_STRUCTURAL_RE.test(p.trimStart());
}

/* Tiret de dialogue : cadratin (—) ou demi-cadratin (–) UNIQUEMENT — jamais
 * le trait d'union ASCII (-), presque toujours une puce de liste Markdown
 * dans ce contexte, pas une réplique. Exigé suivi d'un caractère qui n'est
 * ni un espace ni un autre tiret, pour écarter une ligne de séparation
 * (— — — ou une suite de tirets) qui ouvrirait sans porter de parole. */
const DIALOGUE_DASH_RE = /^[—–]\s*[^\s—–]/;

/* Guillemets français « » et doubles guillemets courbes (“ ”/„ ”) : seul le
 * contenu ENTRE les guillemets compte comme dialogue, jamais le paragraphe
 * entier qui les entoure (une incise narrative autour d'une réplique courte
 * ne doit pas gonfler le ratio). Seuil minimal en mots : une citation d'un
 * titre ou d'un mot isolé (« Il faut cultiver notre jardin », « le journal »)
 * reste sous ce seuil la plupart du temps et n'est donc pas comptée — une
 * heuristique, pas une distinction sémantique parfaite entre citation et
 * réplique. */
const QUOTE_SPAN_RE = /«([^»]+)»|“([^”]+)”|„([^“”]+)[“”]/g;
const MIN_QUOTE_DIALOGUE_WORDS = 3;

/** Mots réellement dialogués dans un paragraphe : soit la ligne entière si
 * elle ouvre par un vrai tiret de dialogue, soit uniquement les mots à
 * l'intérieur de guillemets assez longs pour être une réplique plutôt qu'une
 * citation. Jamais la longueur brute du paragraphe pour une simple présence
 * de guillemets. */
function dialogueWordsIn(paragraph: string): number {
  if (isStructuralParagraph(paragraph)) return 0;

  if (DIALOGUE_DASH_RE.test(paragraph.trimStart())) {
    return wordTokens(paragraph).length;
  }

  let total = 0;
  QUOTE_SPAN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = QUOTE_SPAN_RE.exec(paragraph)) !== null) {
    const inner = m[1] ?? m[2] ?? m[3] ?? "";
    const words = wordTokens(inner).length;
    if (words >= MIN_QUOTE_DIALOGUE_WORDS) total += words;
  }
  return total;
}

/** Métriques d'un texte de prose. Retourne des valeurs BRUTES (pas de score
 * composite) : mots, phrases, paragraphes, longueurs moyennes, phrases
 * longues (>40 mots) et ratio dialogue (part des mots dans des paragraphes de
 * dialogue). `longSentences` liste les phrases concernées pour une future
 * navigation. */
export function analyzeProse(rawText: string | null | undefined) {
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
    paraWords += wordTokens(p).length;
    dialogueWords += dialogueWordsIn(p);
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
