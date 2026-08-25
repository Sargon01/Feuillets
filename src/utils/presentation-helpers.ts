/**
 * Utilitaires pour les vues de Présentation.
 * Fonction d'accès au réglage roleEditorDisplay depuis l'app.
 * Accès purement défensif : aucun casting, accès sécurisé via Object.getOwnPropertyNames.
 */

import type { App } from "obsidian";
import { presentationThemeForFile, type ResolvedPresentationTheme } from "../services/presentation-theme.js";
import { getLocale } from "../i18n/index.js";

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

export function getPresentationTheme(app: App, filePath: string): ResolvedPresentationTheme {
  const pluginsObj = safeGetProperty(app, "plugins");
  const pluginsMap = safeGetProperty(pluginsObj, "plugins");
  const plugin = safeGetProperty(pluginsMap, "feuillets");
  const settingsValue = safeGetProperty(plugin, "settings");
  if (!settingsValue || typeof settingsValue !== "object") return presentationThemeForFile({ presentationTheme: "classic", presentationThemes: {}, projectMeta: {}, projectFolder: undefined }, filePath, getLocale());
  const settings = settingsValue as Partial<FeuilletsSettings>;
  return presentationThemeForFile({
    presentationTheme: settings.presentationTheme,
    presentationThemes: settings.presentationThemes ?? {},
    projectMeta: settings.projectMeta ?? {},
    projectFolder: settings.projectFolder,
  }, filePath, getLocale());
}
