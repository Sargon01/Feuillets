/** Second moteur de correspondance du panneau Contexte (Lot 5) — recherche
 * dans le CONTENU des documents associés, entièrement indépendant du moteur
 * fiable (context-matcher.ts, titres/alias/tags, Lot 3/4) : aucun import ni
 * aucune donnée partagée entre les deux au-delà du texte de requête déjà
 * produit par context-window.ts. Fonctions pures, sans dépendance à
 * Obsidian, testables isolément — comme context-matcher.ts.
 *
 * Règle de correspondance : un document ne remonte que s'il partage avec le
 * passage courant AU MOINS deux termes significatifs distincts, OU une
 * expression contiguë d'au moins deux mots (dont un significatif). Un seul
 * mot générique isolé ne suffit jamais — c'est la garde principale contre
 * le bruit d'une recherche plein texte naïve.
 */

export type ContentSourceKind = "feuillet" | "chapter";

export interface ContentCandidate {
  path: string;
  title: string;
  basename?: string;
  cleanedBody: string;
  sourceKind: ContentSourceKind;
  sourcePriority: number;
}

export interface ContentMatch {
  path: string;
  title: string;
  sourceKind: ContentSourceKind;
  score: number;
  matchedTerms: string[];
  /** Expression contiguë ayant déclenché la correspondance, si trouvée
   * (sinon liste vide — seuls des termes distincts épars ont matché). */
  matchedExpression: string[];
  excerpt: string;
}

export interface ContentMatcherOptions {
  limit?: number;
  /** Chemins déjà remontés par le moteur fiable (Lot 3/4) — jamais
   * dupliqués ici, quel que soit leur score de contenu. */
  excludePaths?: Iterable<string>;
}

const DEFAULT_LIMIT = 5;
const EXCERPT_TARGET_LENGTH = 180;
/** Longueur minimale pour qu'un mot compte comme terme significatif — un
 * seuil volontairement bas (3) : le filtrage du bruit vient surtout de la
 * règle "deux termes distincts ou une expression", pas de la longueur d'un
 * mot pris isolément. */
const MIN_SIGNIFICANT_WORD_LENGTH = 3;

const WEAK_WORDS = new Set([
  "de", "du", "des", "la", "le", "les", "un", "une", "et", "en", "dans", "sur", "avec", "pour", "par",
  "au", "aux", "à", "a", "d", "l", "ce", "ces", "cet", "cette", "son", "sa", "ses", "leur", "leurs",
  "que", "qui", "quoi", "dont", "où", "est", "sont", "était", "être", "avoir", "il", "elle", "ils",
  "elles", "on", "nous", "vous", "je", "tu", "ne", "pas", "plus", "comme", "mais", "ou", "si", "tout",
  "the", "of", "a", "an", "and", "in", "on", "with", "for", "to", "is", "are", "was", "were", "it",
  "he", "she", "they", "this", "that", "not"
]);

function stripDiacritics(word: string): string {
  return word.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Normalise un mot isolé : minuscules, sans accents, apostrophes/tirets
 * internes retirés (comparaison sur la racine, pas la graphie). */
function normalizeWord(word: string): string {
  return stripDiacritics(word.toLowerCase()).replace(/['’ʼ`-]/g, "");
}

function isWeakWord(norm: string): boolean {
  if (!norm) return true;
  if (WEAK_WORDS.has(norm)) return true;
  if (norm.length < MIN_SIGNIFICANT_WORD_LENGTH) return true;
  if (/^\d+$/.test(norm)) return true;
  return false;
}

interface Token {
  norm: string;
  start: number;
  end: number;
}

/** Découpe `text` en jetons "mot" avec leurs positions D'ORIGINE dans
 * `text` — indispensable pour situer un extrait dans le corps nettoyé sans
 * dépendre d'un texte normalisé dont les espaces auraient été fusionnés
 * (ce qui décalerait tous les offsets).
 *
 * `\p{M}` (marques combinantes) fait partie de la classe de caractères au
 * même titre que `\p{L}`/`\p{N}` : un caractère accentué écrit en Unicode
 * décomposé (NFD — lettre de base suivie d'un accent combinant séparé,
 * ex. "e"+"´" au lieu du seul caractère précomposé "é") ne casse ainsi
 * jamais un mot en deux jetons. Sans ce garde-fou, "épices" en NFD était
 * tronqué en "e" + "pices" — deux jetons qui ne correspondent plus à
 * "epices" une fois normalizeWord() appliqué, faisant silencieusement
 * échouer toute correspondance sur ce mot (bug constaté en test manuel :
 * texte source et fiche visuellement identiques, l'un des deux encodé en
 * NFD, jamais détecté). normalizeWord() gère déjà NFC et NFD en sortie de
 * jeton (via son propre normalize("NFD")) ; encore fallait-il que le jeton
 * capturé soit complet en entrée. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const norm = normalizeWord(m[0]);
    if (norm) tokens.push({ norm, start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

/** Plus longue suite CONTIGUË commune entre deux listes de jetons normalisés
 * (recherche de sous-tableau, pas de sous-suite) — implémentation en O(n·m)
 * par programmation dynamique à deux lignes. Renvoie la première occurrence
 * rencontrée à longueur maximale égale (balayage `a` puis `b` croissant),
 * pour un résultat déterministe. `length === 0` si aucun jeton commun. */
function longestCommonRun(
  a: string[],
  b: string[]
): { aStart: number; bStart: number; length: number } {
  let best = { aStart: -1, bStart: -1, length: 0 };
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    const curr = new Array(b.length + 1).fill(0);
    for (let j = 0; j < b.length; j++) {
      if (a[i] && a[i] === b[j]) {
        const len = prev[j] + 1;
        curr[j + 1] = len;
        if (len > best.length) {
          best = { aStart: i - len + 1, bStart: j - len + 1, length: len };
        }
      } else {
        curr[j + 1] = 0;
      }
    }
    prev = curr;
  }
  return best;
}

/** Recule `idx` jusqu'au début du mot en cours (frontière = espace/limite de
 * texte) : ne coupe jamais un mot au début d'un extrait. */
function snapToWordStart(text: string, idx: number): number {
  let i = Math.max(0, Math.min(idx, text.length));
  while (i > 0 && !/\s/.test(text[i - 1])) i--;
  return i;
}

/** Avance `idx` jusqu'à la fin du mot en cours : ne coupe jamais un mot en
 * fin d'extrait. */
function snapToWordEnd(text: string, idx: number): number {
  let i = Math.max(0, Math.min(idx, text.length));
  while (i < text.length && !/\s/.test(text[i])) i++;
  return i;
}

/** Extrait lisible d'environ `targetLength` caractères autour de
 * [matchStart, matchEnd[ — jamais coupé au milieu d'un mot (voir
 * snapToWordStart/End), avec des points de suspension quand le document se
 * poursuit avant/après. Gère nativement une correspondance proche du début
 * ou de la fin (les bornes sont clampées à [0, text.length] avant tout
 * calcul). */
function buildExcerpt(
  text: string,
  matchStart: number,
  matchEnd: number,
  targetLength: number = EXCERPT_TARGET_LENGTH
): string {
  const total = text.length;
  const safeStart = Math.max(0, Math.min(matchStart, total));
  const safeEnd = Math.max(safeStart, Math.min(matchEnd, total));

  const matchLen = safeEnd - safeStart;
  const pad = Math.max(0, targetLength - matchLen);
  let start = Math.max(0, safeStart - Math.floor(pad / 2));
  let end = Math.min(total, safeEnd + Math.ceil(pad / 2));

  // Le document est court des deux côtés : reporter le budget inutilisé
  // d'un bord sur l'autre plutôt que de laisser un extrait plus court que
  // nécessaire.
  if (end - start < targetLength) {
    if (start === 0) end = Math.min(total, start + targetLength);
    else if (end === total) start = Math.max(0, end - targetLength);
  }

  start = snapToWordStart(text, start);
  end = snapToWordEnd(text, end);

  const prefix = start > 0 ? "…" : "";
  const suffix = end < total ? "…" : "";
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();

  return `${prefix}${body}${suffix}`;
}

/** Termes significatifs distincts d'un texte de requête (mots normalisés,
 * dédupliqués, filtrés des mots faibles/trop courts) — dans leur ordre de
 * première apparition, pour un résultat déterministe. */
function significantQueryTerms(queryTokens: Token[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const tok of queryTokens) {
    if (isWeakWord(tok.norm) || seen.has(tok.norm)) continue;
    seen.add(tok.norm);
    terms.push(tok.norm);
  }
  return terms;
}

/**
 * Moteur de correspondance CONTENU — indépendant de matchContext(). `text`
 * est le passage courant déjà fourni par context-window.ts (Lot 4), jamais
 * le feuillet entier. `candidates` doit déjà être scopé aux SEULES sources
 * feuillet/chapitre (jamais project-research, jamais tout le coffre) — ce
 * filtrage est la responsabilité de l'appelant (voir notes-view.ts
 * contentSourcesFor), pas de ce module.
 */
export function matchContent(
  text: string,
  candidates: ContentCandidate[],
  options?: ContentMatcherOptions
): ContentMatch[] {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  if (!text || !candidates || candidates.length === 0) return [];

  const excludePaths = new Set(options?.excludePaths ?? []);

  const queryTokens = tokenize(text);
  if (queryTokens.length === 0) return [];
  const queryNorms = queryTokens.map((t) => t.norm);
  const sigQueryTerms = significantQueryTerms(queryTokens);
  const sigQueryTermSet = new Set(sigQueryTerms);
  if (sigQueryTerms.length === 0) return [];

  const results: Array<{ match: ContentMatch; originalIndex: number }> = [];

  candidates.forEach((candidate, originalIndex) => {
    if (!candidate || !candidate.path) return;
    if (excludePaths.has(candidate.path)) return;
    if (!candidate.cleanedBody) return;

    const docTokens = tokenize(candidate.cleanedBody);
    if (docTokens.length === 0) return;
    const docNorms = docTokens.map((t) => t.norm);
    const docNormSet = new Set(docNorms);

    const matchedTerms = sigQueryTerms.filter((term) => docNormSet.has(term));

    const run = longestCommonRun(queryNorms, docNorms);
    const runHasSignificant =
      run.length >= 2 &&
      queryNorms.slice(run.aStart, run.aStart + run.length).some((w) => !isWeakWord(w));
    const hasExpression = runHasSignificant;

    if (matchedTerms.length < 2 && !hasExpression) return;

    const matchedExpression = hasExpression
      ? queryTokens.slice(run.aStart, run.aStart + run.length).map((t) => t.norm)
      : [];

    const score =
      (hasExpression ? 100000 + run.length * 1000 : 0) + matchedTerms.length * 100;

    let matchStart: number;
    let matchEnd: number;
    if (hasExpression) {
      matchStart = docTokens[run.bStart].start;
      matchEnd = docTokens[run.bStart + run.length - 1].end;
    } else {
      // Premier terme significatif commun rencontré dans le document
      // (ordre du document, déterministe) — sert de centre à l'extrait.
      const firstMatchedTerm = docTokens.find((tok) => sigQueryTermSet.has(tok.norm) && matchedTerms.includes(tok.norm));
      if (firstMatchedTerm) {
        matchStart = firstMatchedTerm.start;
        matchEnd = firstMatchedTerm.end;
      } else {
        matchStart = 0;
        matchEnd = 0;
      }
    }

    const excerpt = buildExcerpt(candidate.cleanedBody, matchStart, matchEnd);

    results.push({
      match: {
        path: candidate.path,
        title: candidate.title,
        sourceKind: candidate.sourceKind,
        score,
        matchedTerms,
        matchedExpression,
        excerpt,
      },
      originalIndex,
    });
  });

  /* Tri déterministe :
   * 1. score décroissant (encode déjà "expression commune" puis "nombre de
   *    termes distincts", l'écart de magnitude entre les deux empêche tout
   *    chevauchement) ;
   * 2. source feuillet avant chapitre (sourcePriority croissant) ;
   * 3. ordre stable (originalIndex — ordre de collecte feuillet puis
   *    chapitre, voir context-content-cache.ts) ;
   * 4. path, dernier départage. */
  results.sort((a, b) => {
    if (b.match.score !== a.match.score) return b.match.score - a.match.score;

    const candA = candidates[a.originalIndex];
    const candB = candidates[b.originalIndex];
    const prioA = candA?.sourcePriority ?? 0;
    const prioB = candB?.sourcePriority ?? 0;
    if (prioA !== prioB) return prioA - prioB;

    if (a.originalIndex !== b.originalIndex) return a.originalIndex - b.originalIndex;

    if (a.match.path !== b.match.path) return a.match.path < b.match.path ? -1 : 1;
    return 0;
  });

  return results.slice(0, limit).map((r) => r.match);
}
