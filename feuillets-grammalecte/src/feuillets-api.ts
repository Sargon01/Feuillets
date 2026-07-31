/* Pont vers l'API publique de Feuillets.
 *
 * Types partagés : ils sont IMPORTÉS du noyau, jamais recopiés
 * (`import type` — effacé à la compilation, donc aucune dépendance à
 * l'exécution, aucun octet de Feuillets dans notre bundle). C'est l'option la
 * plus simple et la plus sûre tant que les deux projets vivent dans le même
 * dépôt : le contrat ne peut pas dériver en silence, le typecheck du
 * compagnon casse si Feuillets change son API.
 *
 * Si ce dossier était un jour extrait dans son propre dépôt, ce chemin est le
 * SEUL point à changer (vers un `feuillets-api.d.ts` vendu ou un paquet de
 * types) — tout le reste du compagnon importe depuis ce fichier. */

import type { App } from "obsidian";
import type {
  FeuilletsPublicApi,
  LinguisticAnalysisResult,
  LinguisticVocabEntry,
  TextAnalysisInput,
  TextAnalysisIssue,
  TextAnalysisProvider,
} from "../../src/api/text-analysis.ts";

export type {
  FeuilletsPublicApi,
  LinguisticAnalysisResult,
  LinguisticVocabEntry,
  TextAnalysisInput,
  TextAnalysisIssue,
  TextAnalysisProvider,
};

/** Identifiant du greffon principal, tel que déclaré dans son manifest.json. */
export const FEUILLETS_PLUGIN_ID = "feuillets";

/* `app.plugins` n'est pas dans les types publics d'Obsidian : c'est
   néanmoins le point d'entrée standard entre greffons compagnons. On le
   décrit au plus juste plutôt que de caster en `any`, et on valide la forme
   obtenue à l'exécution — Feuillets peut être d'une version antérieure à
   cette API. */
type PluginRegistry = {
  plugins?: Record<string, unknown>;
  enabledPlugins?: Set<string>;
};

type AppWithPlugins = App & { plugins?: PluginRegistry };

function isFeuilletsApi(value: unknown): value is FeuilletsPublicApi {
  if (typeof value !== "object" || value === null) return false;
  const api = value as Partial<FeuilletsPublicApi>;
  return (
    typeof api.registerAnalysisProvider === "function" &&
    typeof api.unregisterAnalysisProvider === "function" &&
    typeof api.getAnalysisProvider === "function"
  );
}

/** Renvoie l'API de Feuillets, ou null s'il n'est pas installé, pas activé,
 *  ou trop ancien pour l'exposer. Ne lève jamais : l'absence de Feuillets est
 *  un cas normal, pas une erreur. */
export function getFeuilletsApi(app: App): FeuilletsPublicApi | null {
  const registry = (app as AppWithPlugins).plugins;
  const plugin = registry?.plugins?.[FEUILLETS_PLUGIN_ID];
  if (typeof plugin !== "object" || plugin === null) return null;
  const api = (plugin as { api?: unknown }).api;
  return isFeuilletsApi(api) ? api : null;
}

/** true si Feuillets est présent mais n'expose pas l'API d'analyse : le
 *  message à afficher n'est alors pas « installez Feuillets » mais « mettez
 *  Feuillets à jour ». */
export function isFeuilletsPresentWithoutApi(app: App): boolean {
  const registry = (app as AppWithPlugins).plugins;
  const plugin = registry?.plugins?.[FEUILLETS_PLUGIN_ID];
  return Boolean(plugin) && getFeuilletsApi(app) === null;
}
