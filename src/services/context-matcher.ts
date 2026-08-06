export interface ContextCandidate {
  id: string;
  path: string;
  title: string;
  basename?: string;
  tags?: string[];
  sourcePriority?: number;
}

export type ContextMatchReason =
  | "exact-title"
  | "exact-basename"
  | "title-terms"
  | "tag"
  | "distinctive-term";

export interface ContextMatch {
  candidate: ContextCandidate;
  score: number;
  reason: ContextMatchReason;
  matchedTerms: string[];
}

export interface ContextMatcherOptions {
  limit?: number;
}

const WEAK_WORDS = new Set([
  // French stop words
  "de", "du", "des", "la", "le", "les", "un", "une", "et", "en", "dans", "sur", "avec", "pour", "par",
  "au", "aux", "à", "a", "d", "l",
  // English stop words
  "the", "of", "a", "an", "and", "in", "on", "with", "for", "to"
]);

const GENERIC_TERMS = new Set([
  "histoire", "ville", "guerre", "personnage", "système", "document", "chapitre",
  "source", "sources", "recherche", "brouillon", "draft", "note", "notes", "archive", "à lire", "a lire", "todo"
]);

const GENERIC_TAGS = new Set([
  "source", "sources", "recherche", "brouillon", "draft", "note", "notes", "archive", "à lire", "a lire", "todo"
]);

/**
 * Normalise une chaîne de caractères :
 * - minuscules
 * - suppression des accents
 * - remplacement des apostrophes, tirets et ponctuation par des espaces
 * - fusion des espaces multiples
 */
export function normalizeString(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’ʼ`\-_/\\,;:!?.()"\[\]{}<>#=~+*&%$@]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isWeakWord(word: string): boolean {
  return WEAK_WORDS.has(word);
}

function isGenericTerm(word: string): boolean {
  return GENERIC_TERMS.has(word);
}

function isGenericTag(word: string): boolean {
  return GENERIC_TAGS.has(word) || GENERIC_TERMS.has(word) || WEAK_WORDS.has(word);
}

/**
 * Vérifie si la séquence de mots `targetWords` apparaît de manière contiguë dans `textWords`.
 */
function containsContiguousSequence(textWords: string[], targetWords: string[]): boolean {
  if (targetWords.length === 0 || textWords.length < targetWords.length) return false;
  for (let i = 0; i <= textWords.length - targetWords.length; i++) {
    let match = true;
    for (let j = 0; j < targetWords.length; j++) {
      if (textWords[i + j] !== targetWords[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Moteur indépendant de correspondance contextuelle entre le texte en cours d'écriture et les fiches candidats.
 */
export function matchContext(
  text: string,
  candidates: ContextCandidate[],
  options?: ContextMatcherOptions
): ContextMatch[] {
  const limit = options?.limit ?? 10;
  if (!text || !candidates || candidates.length === 0) {
    return [];
  }

  const normText = normalizeString(text);
  if (!normText) return [];

  const textWords = normText.split(" ").filter(Boolean);
  const textWordSet = new Set(textWords);

  // 1. Déduplication par candidate.path :
  // Conserver le candidat ayant le sourcePriority le plus faible, ou le premier en cas d'égalité.
  const candidateMap = new Map<string, { candidate: ContextCandidate; originalIndex: number }>();
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate || !candidate.path) continue;

    const currentPriority = candidate.sourcePriority ?? 100;
    const existing = candidateMap.get(candidate.path);

    if (!existing) {
      candidateMap.set(candidate.path, { candidate, originalIndex: i });
    } else {
      const existingPriority = existing.candidate.sourcePriority ?? 100;
      if (currentPriority < existingPriority) {
        candidateMap.set(candidate.path, { candidate, originalIndex: i });
      }
    }
  }

  const matches: Array<{
    match: ContextMatch;
    originalIndex: number;
    sigTitleTermsCount: number;
  }> = [];

  for (const { candidate, originalIndex } of candidateMap.values()) {
    const normTitle = normalizeString(candidate.title || "");
    const titleWords = normTitle.split(" ").filter(Boolean);
    const sigTitleTerms = titleWords.filter(w => !isWeakWord(w) && !isGenericTerm(w));

    const normBasename = candidate.basename ? normalizeString(candidate.basename) : "";
    const basenameWords = normBasename ? normBasename.split(" ").filter(Boolean) : [];
    const sigBasenameTerms = basenameWords.filter(w => !isWeakWord(w) && !isGenericTerm(w));

    let matchedReason: ContextMatchReason | null = null;
    let matchedTerms: string[] = [];
    let score = 0;

    // A. Titre complet (titre contigu OU tous les termes significatifs du titre sont présents)
    const matchedSigTitleTerms = sigTitleTerms.filter(w => textWordSet.has(w));
    const isContiguousTitle = titleWords.length > 0 && containsContiguousSequence(textWords, titleWords);
    const allSigTitleTermsMatched = sigTitleTerms.length > 0 && matchedSigTitleTerms.length === sigTitleTerms.length;

    if (isContiguousTitle || allSigTitleTermsMatched) {
      matchedReason = "exact-title";
      matchedTerms = sigTitleTerms.length > 0 ? sigTitleTerms : titleWords;
      score = 5000 + matchedTerms.length * 10 + (isContiguousTitle ? 5 : 0);
    }
    // B. Basename complet
    else {
      const matchedSigBaseTerms = sigBasenameTerms.filter(w => textWordSet.has(w));
      const isContiguousBase = basenameWords.length > 0 && containsContiguousSequence(textWords, basenameWords);
      const allSigBaseTermsMatched = sigBasenameTerms.length > 0 && matchedSigBaseTerms.length === sigBasenameTerms.length;

      if (isContiguousBase || allSigBaseTermsMatched) {
        matchedReason = "exact-basename";
        matchedTerms = sigBasenameTerms.length > 0 ? sigBasenameTerms : basenameWords;
        score = 4000 + matchedTerms.length * 10 + (isContiguousBase ? 5 : 0);
      }
      // C. Plusieurs termes du titre (au moins 2 termes significatifs dans le texte)
      else if (matchedSigTitleTerms.length >= 2) {
        matchedReason = "title-terms";
        matchedTerms = matchedSigTitleTerms;
        score = 3000 + matchedSigTitleTerms.length * 10;
      }
    }

    // D. Tag exact / Tag hiérarchique (si aucune raison titre supérieure trouvée)
    if (!matchedReason && candidate.tags && candidate.tags.length > 0) {
      for (const rawTag of candidate.tags) {
        if (!rawTag) continue;
        const cleanTag = rawTag.startsWith("#") ? rawTag.slice(1) : rawTag;

        // Détection de la structure hiérarchique
        const parts = cleanTag.split("/").map(p => normalizeString(p)).filter(Boolean);
        const normFullTag = normalizeString(cleanTag);
        const fullTagWords = normFullTag.split(" ").filter(Boolean);

        // Tester le tag complet
        if (fullTagWords.length > 0 && containsContiguousSequence(textWords, fullTagWords)) {
          const sigTagWords = fullTagWords.filter(w => !isGenericTag(w));
          if (sigTagWords.length === 0) {
            continue; // Tag générique seul ignoré
          }
          matchedReason = "tag";
          matchedTerms = sigTagWords;
          score = 2000 + matchedTerms.length * 10;
          break;
        }

        // Tester le segment terminal s'il est hiérarchique
        if (parts.length > 1) {
          const terminalTag = parts[parts.length - 1];
          const terminalWords = terminalTag.split(" ").filter(Boolean);
          if (terminalWords.length > 0 && containsContiguousSequence(textWords, terminalWords)) {
            const sigTerminalWords = terminalWords.filter(w => !isGenericTag(w));
            if (sigTerminalWords.length === 0) {
              continue;
            }
            matchedReason = "tag";
            matchedTerms = sigTerminalWords;
            score = 2000 + matchedTerms.length * 10;
            break;
          }
        }
      }
    }

    // E. Terme distinctif unique (uniquement issu du titre ou du basename)
    if (!matchedReason) {
      if (matchedSigTitleTerms.length === 1) {
        const term = matchedSigTitleTerms[0];
        if (term.length >= 4) {
          matchedReason = "distinctive-term";
          matchedTerms = [term];
          score = 1000 + term.length;
        }
      } else if (matchedSigTitleTerms.length === 0 && sigBasenameTerms.length > 0) {
        const matchedBaseTerms = sigBasenameTerms.filter(w => textWordSet.has(w));
        if (matchedBaseTerms.length === 1) {
          const term = matchedBaseTerms[0];
          if (term.length >= 4) {
            matchedReason = "distinctive-term";
            matchedTerms = [term];
            score = 1000 + term.length;
          }
        }
      }
    }

    // Filtrage du bruit : au moins un terme significatif (non faible et non générique) doit être présent dans le résultat
    const hasSignificantTerm = matchedTerms.some(w => !isWeakWord(w) && !isGenericTerm(w));
    if (!hasSignificantTerm) {
      continue;
    }

    if (matchedReason && score > 0) {
      matches.push({
        match: {
          candidate,
          score,
          reason: matchedReason,
          matchedTerms
        },
        originalIndex,
        sigTitleTermsCount: sigTitleTerms.length
      });
    }
  }

  // Tri strict :
  // 1. score décroissant
  // 2. sourcePriority croissant
  // 3. nombre de termes significatifs du titre croissant
  // 4. index original croissant (stabilité)
  matches.sort((a, b) => {
    if (b.match.score !== a.match.score) {
      return b.match.score - a.match.score;
    }

    const priorityA = a.match.candidate.sourcePriority ?? 100;
    const priorityB = b.match.candidate.sourcePriority ?? 100;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    if (a.sigTitleTermsCount !== b.sigTitleTermsCount) {
      return a.sigTitleTermsCount - b.sigTitleTermsCount;
    }

    return a.originalIndex - b.originalIndex;
  });

  return matches.map(m => m.match).slice(0, limit);
}
