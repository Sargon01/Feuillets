// @ts-check
import { getLanguage } from "obsidian";
import { fr } from "./fr.js";
import { en } from "./en.js";

/** Dictionnaire plat clé -> texte pour une langue. */
type LocaleDict = Record<string, string>;

/** Codes de langue supportés. */
type Locale = "fr" | "en";

/** Dictionnaires par langue. Le français reste la langue de référence. */
const LOCALES: Record<Locale, LocaleDict> = { fr, en };

let currentLocale: Locale = "fr";

/** Change la langue active (repli sur "fr" si code inconnu). */
export function setLocale(locale: string): void {
  currentLocale = (LOCALES as Record<string, LocaleDict>)[locale] ? (locale as Locale) : "fr";
}

/** Retourne la langue active. */
export function getLocale(): Locale {
  return currentLocale;
}



/** Détecte la langue : réglage explicite > langue Obsidian > "fr". */
export function detectLocale(settings?: { language?: string }): Locale {
  const forced = settings?.language;
  if (forced && forced !== "auto" && (LOCALES as Record<string, LocaleDict>)[forced]) {
    return forced as Locale;
  }
  try {
    const obsidianLang = getLanguage();
    if (obsidianLang && (LOCALES as Record<string, LocaleDict>)[obsidianLang]) {
      return obsidianLang as Locale;
    }
  } catch {
    /* getLanguage indisponible (contexte de test) : repli silencieux */
  }
  return "fr";
}

/**
 * Traduit `key` dans la langue active, avec repli sur le français puis sur
 * la clé elle-même (jamais un écran vide, même pour une clé oubliée).
 * `params` : substitution `{nom}` -> valeur, pour les textes avec variables
 * (ex. "compte.mots" -> "{count} mots").
 */
export function t(key: string, params?: Record<string, string>): string {
  const dict = LOCALES[currentLocale] || LOCALES.fr;
  let str = dict[key] ?? LOCALES.fr[key] ?? key;
  if (params) {
    for (const name in params) {
      str = str.replace(new RegExp(`\\{${name}\\}`, "g"), params[name]);
    }
  }
  return str;
}