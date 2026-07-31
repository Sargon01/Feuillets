/* Le fournisseur enregistré auprès de Feuillets.
 *
 * Son rôle tient en quatre lignes : recevoir un texte, charger Grammalecte si
 * ce n'est pas déjà fait, l'analyser, rendre des signalements génériques. Il
 * ne lit aucun fichier, n'ouvre aucune vue, ne touche jamais au document —
 * tout cela est du ressort de Feuillets. */

import type { TextAnalysisInput, TextAnalysisIssue, TextAnalysisProvider } from "./feuillets-api.ts";
import {
  analyseWithEngine,
  loadGrammalecteEngine,
  type GrammalecteEngine,
} from "./grammalecte-adapter.ts";
import { loadEmbeddedAssets } from "./grammalecte-assets.ts";
import type { GrammalecteSettings } from "./settings.ts";

export const PROVIDER_ID = "grammalecte";
export const PROVIDER_NAME = "Grammalecte";

/** Fabrique du moteur, injectable pour les tests : ils vérifient le
 *  chargement paresseux sans jamais lire les 9 Mo de règles réelles. */
export type EngineLoader = () => GrammalecteEngine;

export class GrammalecteProvider implements TextAnalysisProvider {
  readonly id = PROVIDER_ID;
  readonly name = PROVIDER_NAME;

  private engine: GrammalecteEngine | null = null;
  /** Chargement en cours : deux analyses lancées coup sur coup ne doivent
   *  pas charger le moteur deux fois. */
  private loading: Promise<GrammalecteEngine> | null = null;
  private readonly loadEngine: EngineLoader;
  private readonly getSettings: () => GrammalecteSettings;

  constructor(getSettings: () => GrammalecteSettings, loadEngine?: EngineLoader) {
    this.getSettings = getSettings;
    /* Par défaut : archive embarquée -> décompression -> contexte vm. Rien
       de tout cela ne se produit avant le premier appel à analyze(). */
    this.loadEngine = loadEngine ?? (() => loadGrammalecteEngine(loadEmbeddedAssets()));
  }

  /** true si le moteur est déjà en mémoire. Sert aux réglages (et aux tests)
   *  pour constater que rien n'est chargé avant la première analyse. */
  get isEngineLoaded(): boolean {
    return this.engine !== null;
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

    return analyseWithEngine(engine, text, {
      checkSpelling: settings.checkSpelling,
      detectRepetitions: settings.detectRepetitions,
      maxSuggestions: settings.maxSuggestions,
    });
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
      const engine = this.loadEngine();
      this.engine = engine;
      return engine;
    })();

    return this.loading.finally(() => {
      this.loading = null;
    });
  }

  /** Libère le moteur (et ses ~9 Mo) au déchargement du greffon. */
  dispose(): void {
    this.engine = null;
    this.loading = null;
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
