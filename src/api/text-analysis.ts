/* API publique d'analyse de texte de Feuillets.
 *
 * Surface volontairement minimale : Feuillets ne sait pas analyser un texte,
 * il sait seulement demander à un module compagnon de le faire et afficher
 * ce qu'on lui rend. Aucun type ici n'est propre à une langue ni à un moteur
 * — pas de « faute d'orthographe », pas de règle française, pas de
 * Grammalecte : un signalement est une plage de texte, un message et des
 * suggestions.
 *
 * Ce fichier est le contrat partagé avec les greffons compagnons (voir
 * [Feuillets Grammalecte](https://github.com/Sargon01/Feuillets-Grammalecte),
 * qui en importe les types).
 * Toute modification est une rupture d'API : n'ajouter que ce qu'un
 * compagnon réel a besoin d'appeler. */

/** Texte soumis à un fournisseur. Les offsets sont ceux de `text` lui-même,
 * jamais ceux du fichier : c'est Feuillets qui fait la conversion (voir
 * `analysisRangeFor`), pour que le compagnon n'ait rien à savoir du
 * frontmatter ni de la sélection. */
export interface TextAnalysisInput {
  /** Texte à analyser, tel quel. */
  text: string;
  /** Chemin du fichier d'origine, purement informatif (journalisation). */
  filePath?: string;
  /** Bornes de la sélection DANS LE FICHIER, si l'analyse porte sur une
   *  sélection. Fournies à titre de contexte : `text` contient déjà
   *  uniquement la sélection. */
  selectionStart?: number;
  selectionEnd?: number;
}

/** Sévérité d'un signalement. Ne pilote que l'icône et la couleur. */
export type TextAnalysisSeverity = "info" | "warning" | "error";

/** Un signalement. `start`/`end` sont des offsets dans le `text` reçu. */
export interface TextAnalysisIssue {
  /** Identifiant stable optionnel, utile au compagnon pour ses propres
   *  listes (ignorés, appris…). Feuillets ne l'interprète pas. */
  id?: string;
  message: string;
  /** Libellé de catégorie déjà traduit par le fournisseur (« Orthographe »,
   *  « Accord »…). Feuillets l'affiche tel quel, il n'a pas de liste. */
  category?: string;
  severity?: TextAnalysisSeverity;
  filePath?: string;
  start: number;
  end: number;
  suggestions?: string[];
  ruleId?: string;
  /** Texte ou mot directement concerné par le signalement (ex: "ezan"). */
  text?: string;
  /** Indique si le signalement porte sur un mot apprenable dans le dictionnaire. */
  canLearn?: boolean;
}

export type LinguisticVocabEntry = [string, number];

export interface LinguisticAnalysisResult {
  richness?: number;
  uniqueLemmas?: number;
  contentTotal?: number;
  hapaxCount?: number;
  favoriteVerbs?: LinguisticVocabEntry[];
  weakVerbs?: LinguisticVocabEntry[];
  weakTotal?: number;
  weakPct?: number;
  favoriteAdjs?: LinguisticVocabEntry[];
  favoriteAdvs?: LinguisticVocabEntry[];
  mentAdverbs?: LinguisticVocabEntry[];
  mentTotal?: number;
  mentPct?: number;
  passiveCount?: number;
  grammaticalCategories?: Record<string, number>;
}

/** Un module d'analyse enregistré par un greffon compagnon. */
export interface TextAnalysisProvider {
  /** Identifiant unique, en minuscules ("grammalecte"). */
  id: string;
  /** Nom affiché dans l'en-tête du panneau de résultats. */
  name: string;
  analyze(input: TextAnalysisInput): Promise<TextAnalysisIssue[]>;
  /** Ignore une occurrence particulière d'un signalement. Optionnel. */
  ignoreOccurrence?(issue: TextAnalysisIssue): Promise<void> | void;
  /** Apprend un mot pour le dictionnaire de l'utilisateur. Optionnel. */
  learnWord?(word: string, issue?: TextAnalysisIssue): Promise<void> | void;
  /** Analyse linguistique complémentaire (vocabulaire, lemmes, etc.). Optionnel. */
  analyzeLinguistics?(input: TextAnalysisInput): Promise<LinguisticAnalysisResult | null>;
}

/** Signalement tel que Feuillets le manipule après analyse : offsets
 *  reconvertis dans le fichier, et fichier concerné toujours renseigné. */
export interface ResolvedAnalysisIssue extends TextAnalysisIssue {
  filePath: string;
  start: number;
  end: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Valide la forme d'un fournisseur venu d'un autre greffon. Le compagnon
 *  est du code tiers compilé séparément : les types TypeScript ne
 *  garantissent rien à l'exécution, d'où cette vérification explicite. */
export function isTextAnalysisProvider(value: unknown): value is TextAnalysisProvider {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TextAnalysisProvider>;
  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.name) &&
    typeof candidate.analyze === "function"
  );
}

/** Normalise ce que rend un fournisseur : Feuillets ne fait jamais confiance
 *  aux offsets d'un greffon tiers pour indexer un fichier. Les signalements
 *  hors bornes ou inversés sont écartés plutôt que corrigés en silence — un
 *  signalement mal placé sélectionnerait le mauvais passage. */
export function sanitizeIssues(issues: unknown, textLength: number): TextAnalysisIssue[] {
  if (!Array.isArray(issues)) return [];
  const clean: TextAnalysisIssue[] = [];
  for (const raw of issues as unknown[]) {
    if (typeof raw !== "object" || raw === null) continue;
    const issue = raw as Partial<TextAnalysisIssue>;
    if (typeof issue.start !== "number" || typeof issue.end !== "number") continue;
    if (!Number.isInteger(issue.start) || !Number.isInteger(issue.end)) continue;
    if (issue.start < 0 || issue.end > textLength || issue.end < issue.start) continue;
    if (typeof issue.message !== "string") continue;
    clean.push({
      id: typeof issue.id === "string" ? issue.id : undefined,
      message: issue.message,
      category: typeof issue.category === "string" ? issue.category : undefined,
      severity:
        issue.severity === "info" || issue.severity === "warning" || issue.severity === "error"
          ? issue.severity
          : undefined,
      start: issue.start,
      end: issue.end,
      suggestions: Array.isArray(issue.suggestions)
        ? issue.suggestions.filter((s): s is string => typeof s === "string")
        : undefined,
      ruleId: typeof issue.ruleId === "string" ? issue.ruleId : undefined,
      text: typeof issue.text === "string" ? issue.text : undefined,
      canLearn: typeof issue.canLearn === "boolean" ? issue.canLearn : undefined,
    });
  }
  clean.sort((a, b) => a.start - b.start || a.end - b.end);
  return clean;
}

/** Registre des fournisseurs. Un seul par identifiant.
 *
 * Ré-enregistrer le même identifiant REMPLACE l'entrée au lieu d'échouer :
 * c'est le cas normal quand l'utilisateur recharge le greffon compagnon
 * (Obsidian appelle onunload() puis onload(), parfois dans cet ordre-là
 * seulement en apparence — refuser laisserait un fournisseur mort en place). */
export class TextAnalysisRegistry {
  private providers = new Map<string, TextAnalysisProvider>();
  private listeners = new Set<() => void>();

  register(provider: TextAnalysisProvider): void {
    if (!isTextAnalysisProvider(provider)) {
      throw new Error("Feuillets : fournisseur d'analyse invalide (id, name et analyze() sont requis).");
    }
    this.providers.set(provider.id, provider);
    this.emit();
  }

  /** true si un fournisseur a effectivement été retiré. Ne lève jamais :
   *  un compagnon doit pouvoir appeler ceci dans son onunload() sans se
   *  soucier de savoir s'il avait réussi à s'enregistrer. */
  unregister(providerId: string): boolean {
    const removed = this.providers.delete(providerId);
    if (removed) this.emit();
    return removed;
  }

  /** Sans argument : le fournisseur actif, c'est-à-dire le premier
   *  enregistré (il n'y en a qu'un en pratique). null si aucun. */
  get(providerId?: string): TextAnalysisProvider | null {
    if (providerId !== undefined) return this.providers.get(providerId) ?? null;
    for (const provider of this.providers.values()) return provider;
    return null;
  }

  list(): TextAnalysisProvider[] {
    return [...this.providers.values()];
  }

  /** Notifie un changement de fournisseur (installation ou retrait du
   *  compagnon en cours de session), pour rafraîchir le panneau ouvert.
   *  Rend la fonction de désinscription. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Un écouteur défaillant (vue déjà détruite) ne doit pas empêcher
           l'enregistrement d'un fournisseur. */
      }
    }
  }
}

/** API publique exposée sur l'instance du greffon (`plugin.api`).
 *  C'est exactement ce qu'un compagnon peut appeler — rien de plus. */
export interface FeuilletsPublicApi {
  /** Version du contrat ci-dessus. Incrémentée à chaque rupture. */
  readonly apiVersion: number;
  registerAnalysisProvider(provider: TextAnalysisProvider): void;
  unregisterAnalysisProvider(providerId: string): void;
  getAnalysisProvider(providerId?: string): TextAnalysisProvider | null;
}

export const FEUILLETS_API_VERSION = 1;

export function createPublicApi(registry: TextAnalysisRegistry): FeuilletsPublicApi {
  return {
    apiVersion: FEUILLETS_API_VERSION,
    registerAnalysisProvider: (provider) => registry.register(provider),
    unregisterAnalysisProvider: (providerId) => registry.unregister(providerId),
    getAnalysisProvider: (providerId) => registry.get(providerId),
  };
}
