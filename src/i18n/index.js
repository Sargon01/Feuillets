import { fr } from "./fr.js";
import { en } from "./en.js";

/** Dictionnaires plats clé -> texte, un par langue. Le français reste la
 * langue de référence (toutes les clés y existent forcément) ; l'anglais
 * peut être incomplet le temps de la traduction complète — une clé
 * manquante en anglais retombe sur le français plutôt que d'afficher la
 * clé brute. */
const LOCALES = { fr, en };

let currentLocale = "fr";

export function setLocale(locale) {
  currentLocale = LOCALES[locale] ? locale : "fr";
}

export function getLocale() {
  return currentLocale;
}

/** Langue à utiliser : le réglage explicite de l'utilisateur s'il en a
 * choisi un, sinon la langue de l'interface Obsidian elle-même — pour
 * qu'un plugin en anglais s'affiche en anglais sans réglage à faire, et
 * inversement. Repli sur "fr" si ni l'un ni l'autre n'est reconnu. */
export function detectLocale(settings) {
  const forced = settings && settings.language;
  if (forced && forced !== "auto" && LOCALES[forced]) return forced;
  try {
    /* getLanguage() d'Obsidian serait plus propre, mais il est `@since 1.8.7`
       alors que manifest.json déclare minAppVersion 1.7.2 : l'appeler ferait
       échouer le plugin sur 1.7.2–1.8.6 et déclencherait no-unsupported-api,
       qui est classée « Error » par la revue. On garde donc la lecture du
       localStorage, qui est ce que getLanguage() fait en interne.

       La revue laisse un avertissement `obsidianmd/prefer-get-language` sur
       la ligne suivante : il est ASSUMÉ, pas oublié. Le désactiver n'est pas
       possible (eslint-comments/no-restricted-disable interdit de faire taire
       les règles obsidianmd). À basculer sur getLanguage() le jour où
       minAppVersion passera à 1.8.7 ou plus. */
    const obsidianLang = window.localStorage.getItem("language");
    if (obsidianLang && LOCALES[obsidianLang]) return obsidianLang;
  } catch {
    /* localStorage indisponible (contexte de test) : repli silencieux */
  }
  return "fr";
}

/** Traduit `key` dans la langue active, avec repli sur le français puis sur
 * la clé elle-même (jamais un écran vide, même pour une clé oubliée).
 * `params` : substitution `{nom}` -> valeur, pour les textes avec variables
 * (ex. "compte.mots" -> "{count} mots"). */
export function t(key, params) {
  const dict = LOCALES[currentLocale] || LOCALES.fr;
  let str = dict[key] ?? LOCALES.fr[key] ?? key;
  if (params) {
    for (const name in params) {
      str = str.replace(new RegExp(`\\{${name}\\}`, "g"), params[name]);
    }
  }
  return str;
}
