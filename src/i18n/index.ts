// @ts-check
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
    /* getLanguage() d'Obsidian serait plus propre, mais il est `@since 1.8.7`
       alors que manifest.json déclare minAppVersion 1.7.2 : l'appeler ferait
       échouer le plugin sur 1.7.2–1.8.6 et déclencherait no-unsupported-api,
       qui est classée "Error" par la revue. On garde donc la lecture du
       localStorage, qui est ce que getLanguage() fait en interne.

       La revue laisse un avertissement `obsidianmd/prefer-get-language` sur
       la ligne suivante : il est ASSUMÉ, pas oublié. Le désactiver n'est pas
       possible (eslint-comments/no-restricted-disable interdit de faire taire
       les règles obsidianmd). À basculer sur getLanguage() le jour où
       minAppVersion passera à 1.8.7 ou plus. */
    const obsidianLang = window.localStorage.getItem("language");
    if (obsidianLang && (LOCALES as Record<string, LocaleDict>)[obsidianLang]) {
      return obsidianLang as Locale;
    }
  } catch {
    /* localStorage indisponible (contexte de test) : repli silencieux */
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