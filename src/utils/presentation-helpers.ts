/**
 * Utilitaires pour les vues de Présentation.
 * Fonction d'accès au réglage roleEditorDisplay depuis l'app.
 * Accès purement défensif : aucun casting, accès sécurisé via Object.getOwnPropertyNames.
 */

import type { App } from "obsidian";

/**
 * Vérifie si un object a une propriété donnée et retourne sa valeur.
 * @internal Fonction d'accès défensif, ne fait aucun casting.
 */
function safeGetProperty(obj: unknown, key: string): unknown {
  if (obj === null || obj === undefined || typeof obj !== "object") {
    return undefined;
  }
  const props = Object.getOwnPropertyNames(obj);
  if (!props.includes(key)) {
    return undefined;
  }
  try {
    return (obj as { [k: string]: unknown })[key];
  } catch {
    return undefined;
  }
}

/**
 * Récupère le réglage roleEditorDisplay depuis le plugin Feuillets.
 * Retourne "callouts" (défaut) si le plugin n'est pas trouvé ou si le réglage manque.
 */
export function getRoleEditorDisplay(app: App): "callouts" | "compact" {
  try {
    // Accès étape par étape sans casting dangereux
    const pluginsObj = safeGetProperty(app, "plugins");
    if (!pluginsObj || typeof pluginsObj !== "object") {
      return "callouts";
    }

    const pluginsMap = safeGetProperty(pluginsObj, "plugins");
    if (!pluginsMap || typeof pluginsMap !== "object") {
      return "callouts";
    }

    const feuilletsPlugin = safeGetProperty(pluginsMap, "feuillets");
    if (!feuilletsPlugin || typeof feuilletsPlugin !== "object") {
      return "callouts";
    }

    const settings = safeGetProperty(feuilletsPlugin, "settings");
    if (!settings || typeof settings !== "object") {
      return "callouts";
    }

    const roleDisplay = safeGetProperty(settings, "roleEditorDisplay");
    if (roleDisplay === "callouts" || roleDisplay === "compact") {
      return roleDisplay;
    }

    return "callouts";
  } catch {
    // En cas d'erreur quelconque, retour à la valeur par défaut
    return "callouts";
  }
}
