/* Le fournisseur enregistré auprès de Feuillets.
 *
 * Son rôle tient en quatre lignes : recevoir un texte, charger Grammalecte si
 * ce n'est pas déjà fait, l'analyser, rendre des signalements génériques. Il
 * ne lit aucun fichier, n'ouvre aucune vue, ne touche jamais au document —
 * tout cela est du ressort de Feuillets. */

import type {
  LinguisticAnalysisResult,
  TextAnalysisInput,
  TextAnalysisIssue,
  TextAnalysisProvider,
} from "./feuillets-api.ts";
import {
  analyseWithEngine,
  analyzeLinguisticsWithEngine,
  CATEGORY_SPELLING,
  loadGrammalecteEngine,
  type GrammalecteEngine,
} from "./grammalecte-adapter.ts";
import { loadEmbeddedAssets } from "./grammalecte-assets.ts";
import type { GrammalecteSettings } from "./settings.ts";

export const PROVIDER_ID = "grammalecte";
export const PROVIDER_NAME = "Grammalecte";

/** Fabrique du moteur, injectable pour les tests : ils vérifient le
 *  chargement paresseux sans jamais lire les 9 Mo de règles réelles. */
export type EngineLoader = () => GrammalecteEngine | Promise<GrammalecteEngine>;

export class GrammalecteProvider implements TextAnalysisProvider {
  readonly id = PROVIDER_ID;
  readonly name = PROVIDER_NAME;

  private engine: GrammalecteEngine | null = null;
  /** Chargement en cours : deux analyses lancées coup sur coup ne doivent
   *  pas charger le moteur deux fois. */
  private loading: Promise<GrammalecteEngine> | null = null;
  private readonly loadEngine: EngineLoader;
  private readonly getSettings: () => GrammalecteSettings;
  private readonly saveSettings?: () => Promise<void>;

  /** Occurrences ignorées pour la SESSION SEULEMENT (en mémoire, pas dans data.json). */
  private ignoredSignatures = new Set<string>();

  constructor(
    getSettings: () => GrammalecteSettings,
    saveSettingsOrLoadEngine?: (() => Promise<void>) | EngineLoader,
    loadEngine?: EngineLoader
  ) {
    this.getSettings = getSettings;
    if (loadEngine !== undefined) {
      this.saveSettings = saveSettingsOrLoadEngine as (() => Promise<void>);
      this.loadEngine = loadEngine;
    } else if (typeof saveSettingsOrLoadEngine === "function") {
      this.saveSettings = saveSettingsOrLoadEngine as (() => Promise<void>);
      this.loadEngine = saveSettingsOrLoadEngine as EngineLoader;
    } else {
      this.loadEngine = () => loadGrammalecteEngine(loadEmbeddedAssets());
    }
  }

  /** true si le moteur est déjà en mémoire. Sert aux réglages (et aux tests)
   *  pour constater que rien n'est chargé avant la première analyse. */
  get isEngineLoaded(): boolean {
    return this.engine !== null;
  }

  async ignoreOccurrence(issue: TextAnalysisIssue): Promise<void> {
    const key = issue.id || `${issue.ruleId ?? "issue"}:${issue.start}:${issue.end}`;
    this.ignoredSignatures.add(key);
  }

  async learnWord(word: string): Promise<void> {
    const cleanWord = word.trim();
    if (!cleanWord) return;
    const settings = this.getSettings();
    if (!settings.learnedWords) settings.learnedWords = [];
    if (!settings.learnedWords.some((w) => w.toLowerCase() === cleanWord.toLowerCase())) {
      settings.learnedWords.push(cleanWord);
      if (this.saveSettings) {
        await this.saveSettings();
      }
    }
  }

  async analyze(input: TextAnalysisInput): Promise<TextAnalysisIssue[]> {
    const text = typeof input?.text === "string" ? input.text : "";
    if (text.trim() === "") return [];

    const engine = await this.ensureEngine();
    const settings = this.getSettings();

    /* window.setTimeout(0) : laisse l'interface afficher « Analyse en
       cours… » avant le calcul, qui est synchrone et bloquant (pas de vrai
       parallélisme possible — worker_threads n'est pas disponible dans le
       process de rendu des greffons, et fork() y relance Obsidian lui-même). */
    await nextTick();

    const rawIssues = analyseWithEngine(engine, text, {
      checkSpelling: settings.checkSpelling,
      detectRepetitions: settings.detectRepetitions,
      maxSuggestions: settings.maxSuggestions,
    });

    const learnedSet = new Set((settings.learnedWords || []).map((w) => w.toLowerCase()));

    return rawIssues.filter((issue) => {
      const issueKey = issue.id || `${issue.ruleId ?? "issue"}:${issue.start}:${issue.end}`;
      if (this.ignoredSignatures.has(issueKey)) return false;

      // Masquer les mots appris UNIQUEMENT pour les erreurs d'orthographe (jamais la grammaire)
      const isSpelling = issue.category === CATEGORY_SPELLING || issue.canLearn === true;
      if (isSpelling) {
        const targetWord = (issue.text || text.slice(issue.start, issue.end)).trim().toLowerCase();
        if (learnedSet.has(targetWord)) return false;
      }

      return true;
    });
  }

  async analyzeLinguistics(input: TextAnalysisInput): Promise<LinguisticAnalysisResult | null> {
    const text = typeof input?.text === "string" ? input.text : "";
    if (text.trim() === "") return null;

    const engine = await this.ensureEngine();
    await nextTick();
    return analyzeLinguisticsWithEngine(engine, text);
  }

  /** Chargement paresseux : le moteur n'est monté qu'ici, donc à la première
   *  analyse — jamais au démarrage d'Obsidian. Un échec ne laisse rien de
   *  cassé derrière lui : `loading` est libéré, la tentative suivante
   *  repartira de zéro (utile après avoir déposé les ressources manquantes). */
  private ensureEngine(): Promise<GrammalecteEngine> {
    if (this.engine) return Promise.resolve(this.engine);
    if (this.loading) return this.loading;

    this.loading = (async () => {
      await nextTick();
      const res = await this.loadEngine();
      if (res && typeof (res as unknown as Partial<GrammalecteEngine>).parse === "function") {
        this.engine = res;
      } else {
        this.engine = loadGrammalecteEngine(loadEmbeddedAssets());
      }
      return this.engine;
    })();

    return this.loading.finally(() => {
      this.loading = null;
    });
  }

  /** Libère le moteur (et ses ~9 Mo) au déchargement du greffon. */
  dispose(): void {
    this.engine = null;
    this.loading = null;
    this.ignoredSignatures.clear();
  }
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    const schedule =
      typeof window !== "undefined" && typeof window.setTimeout === "function"
        ? window.setTimeout
        : setTimeout;
    schedule(() => resolve(), 0);
  });
}
