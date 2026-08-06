export interface ContextCandidate {
  id: string;
  path: string;
  title: string;
  basename?: string;
  tags?: string[];
  /** Alias de frontmatter (Obsidian `aliases`) — entièrement FACULTATIFS :
   * aucune métadonnée n'est exigée, mais un alias existant doit produire
   * une correspondance aussi fiable qu'un titre (voir la raison "alias"
   * ci-dessous, classée juste sous "exact-title" et au-dessus de "tag"). */
  aliases?: string[];
  sourcePriority?: number;
}

export type ContextMatchReason =
  | "exact-title"
  | "alias"
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

/* Mots génériques d'un titre à ne JAMAIS considérer significatifs comme
 * déclencheur seul — un titre PORTANT UN DE CES MOTS reste néanmoins
 * retrouvable par correspondance EXACTE (titre/alias/basename complet, voir
 * isGenericTerm ci-dessous) : c'est seulement comme signal PARTIEL (terme
 * distinctif isolé partagé entre deux titres différents, ou l'un des
 * plusieurs "termes du titre" comptés) qu'ils ne comptent jamais. */
const GENERIC_TERMS = new Set([
  "histoire", "ville", "guerre", "personnage", "système", "document", "chapitre",
  "source", "sources", "recherche", "brouillon", "draft", "note", "notes", "archive", "à lire", "a lire", "todo"
]);

/* Mots génériques SUPPLÉMENTAIRES, exclus des signaux PARTIELS uniquement
 * (jamais de la correspondance EXACTE) — "Port de Lisbonne" et "Port de
 * Suvasa" partagent "port" sans être la même fiche : un seul terme
 * générique partagé ne suffit jamais à déclencher une correspondance via
 * le "terme distinctif unique" ou "plusieurs termes du titre" (voir plus
 * bas). Mais une fiche titrée EXACTEMENT "Port", "Commerce", "Route",
 * "Plan" ou "Quartier" doit rester trouvable par son titre complet — d'où
 * un ensemble SÉPARÉ de GENERIC_TERMS (qui, lui, bloque même la
 * correspondance exacte, voir "Histoire"/"Ville" testés depuis toujours). */
const PARTIAL_ONLY_GENERIC_TERMS = new Set([
  "port", "route", "commerce", "quartier", "plan"
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

/** Générique au sens large — pour tout usage comme signal PARTIEL
 * (comptage des "termes du titre", terme distinctif isolé) : inclut aussi
 * PARTIAL_ONLY_GENERIC_TERMS (voir sa définition). Ne JAMAIS utiliser ceci
 * pour la garde finale de bruit (celle-là doit laisser passer une
 * correspondance EXACTE même sur un titre composé uniquement de ces mots
 * — voir isGenericTerm, utilisé là intentionnellement seul). */
function isPartialSignalGeneric(word: string): boolean {
  return GENERIC_TERMS.has(word) || PARTIAL_ONLY_GENERIC_TERMS.has(word);
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
 * Cherche un alias COMPLET (mots entiers, contigu OU tous ses termes
 * significatifs présents dans le texte — même définition que le titre)
 * parmi `aliases`. Ne fait JAMAIS d'un mot isolé d'un alias multi-mots une
 * correspondance : un alias de deux mots ou plus doit être retrouvé en
 * entier, jamais partiellement — c'est la règle qui évite le bruit qu'un
 * simple "terme distinctif" introduirait sur des prénoms/mots courants
 * partagés par plusieurs fiches.
 */
function matchFullAlias(
  aliases: string[] | undefined,
  textWords: string[],
  textWordSet: Set<string>
): { terms: string[]; contiguous: boolean } | null {
  if (!aliases || aliases.length === 0) return null;

  for (const rawAlias of aliases) {
    if (!rawAlias) continue;
    const normAlias = normalizeString(rawAlias);
    const aliasWords = normAlias.split(" ").filter(Boolean);
    if (aliasWords.length === 0) continue;

    const sigAliasTerms = aliasWords.filter(w => !isWeakWord(w) && !isPartialSignalGeneric(w));
    const matchedSigAliasTerms = sigAliasTerms.filter(w => textWordSet.has(w));
    const isContiguousAlias = containsContiguousSequence(textWords, aliasWords);
    const allSigAliasTermsMatched = sigAliasTerms.length > 0 && matchedSigAliasTerms.length === sigAliasTerms.length;

    if (isContiguousAlias || allSigAliasTermsMatched) {
      return {
        terms: sigAliasTerms.length > 0 ? sigAliasTerms : aliasWords,
        contiguous: isContiguousAlias
      };
    }
  }

  return null;
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
    const sigTitleTerms = titleWords.filter(w => !isWeakWord(w) && !isPartialSignalGeneric(w));

    const normBasename = candidate.basename ? normalizeString(candidate.basename) : "";
    const basenameWords = normBasename ? normBasename.split(" ").filter(Boolean) : [];
    const sigBasenameTerms = basenameWords.filter(w => !isWeakWord(w) && !isPartialSignalGeneric(w));

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
    else {
      // A2. Alias complet — facultatif (candidate.aliases peut être absent),
      // mais aussi fiable qu'un titre quand il est présent : classé juste
      // sous "exact-title" et au-dessus de "exact-basename"/"tag".
      const aliasMatch = matchFullAlias(candidate.aliases, textWords, textWordSet);
      if (aliasMatch) {
        matchedReason = "alias";
        matchedTerms = aliasMatch.terms;
        score = 4500 + matchedTerms.length * 10 + (aliasMatch.contiguous ? 5 : 0);
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

    /* Filtrage du bruit : au moins un terme significatif (non faible et non
     * générique — voir isGenericTerm, l'ensemble STRICT, jamais celui élargi
     * PARTIAL_ONLY_GENERIC_TERMS) doit être présent dans le résultat. Un
     * titre composé UNIQUEMENT d'un mot du groupe "partiel seulement" (ex.
     * "Port", "Commerce"…) garde ainsi ce mot comme significatif ICI — sa
     * correspondance était déjà EXACTE (titre/alias/basename complet) pour
     * avoir atteint ce point, sigTitleTerms l'ayant exclu plus haut ne joue
     * que sur le comptage des signaux PARTIELS (title-terms/distinctive-
     * term), jamais sur cette garde finale. */
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

  const sortedMatches = matches.map(m => m.match);

  /* Déduplication logique par TITRE normalisé : plusieurs fichiers
   * différents (feuillet/chapitre/recherche du projet) peuvent porter
   * exactement le même titre — le panneau Contexte ne doit montrer cette
   * fiche logique qu'une fois, pas une entrée par source. Appliquée APRÈS
   * le tri (score desc, sourcePriority asc, stabilité) et AVANT la limite
   * finale : le premier match rencontré pour un titre donné est donc déjà
   * le meilleur (règle "conserver le meilleur"), jamais recalculé ici.
   * Clé = candidate.title normalisé (jamais basename : un titre explicite
   * différent ne doit jamais être fusionné avec un autre). La déduplication
   * par candidate.path plus haut reste inchangée — celle-ci s'ajoute, elle
   * ne la remplace pas. */
  const seenTitles = new Set<string>();
  const uniqueMatches: ContextMatch[] = [];
  for (const match of sortedMatches) {
    const key = normalizeString(match.candidate.title || "");
    if (key && seenTitles.has(key)) continue;
    if (key) seenTitles.add(key);
    uniqueMatches.push(match);
  }

  return uniqueMatches.slice(0, limit);
}
