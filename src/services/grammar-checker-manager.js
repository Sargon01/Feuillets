import { checkTextLanguageTool } from "./languagetool-checker.js";

const COMPANION_PLUGIN_ID = "feuillet-linters";

/**
 * Orchestrateur de vérification linguistique pour Feuillets.
 * Redirige vers le compagnon local "Feuillet Linters" (Grammalecte FR /
 * Harper EN, aucun appel réseau) ou vers LanguageTool (cloud/local API,
 * multi-langue, sélectionné explicitement ou utilisé en secours quand le
 * compagnon n'est pas installé ou ne couvre pas la langue/plateforme visée).
 */
export class GrammarCheckerManager {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
  }

  getCompanion() {
    const plugin = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins[COMPANION_PLUGIN_ID];
    return plugin && plugin.api ? plugin.api : null;
  }

  async checkText(text, settings, activeLocale = "fr") {
    const engine = settings ? settings.grammarEngine || "grammalecte" : "grammalecte";

    if (engine === "off") {
      return [];
    }

    const knownWords = settings ? settings.grammalecteKnownWords || [] : [];
    const ignoredRules = settings ? settings.grammalecteIgnoredRules || [] : [];
    const detectRepetitions = settings ? !!settings.grammalecteDetectRepetitions : false;

    const languageToolOptions = () => ({
      url: settings.languageToolUrl || "https://api.languagetool.org/v2/check",
      language: settings.languageToolLanguage || "auto",
      knownWords,
      ignoredRules,
    });

    if (engine === "languagetool") {
      return checkTextLanguageTool(text, languageToolOptions());
    }

    const lang = activeLocale === "fr" || (settings.languageToolLanguage && settings.languageToolLanguage.startsWith("fr")) ? "fr" : "en";

    if (engine === "auto" && lang !== "fr") {
      return checkTextLanguageTool(text, languageToolOptions());
    }

    // Mode local (compagnon Feuillet Linters) : Grammalecte FR / Harper EN,
    // aucun appel réseau. Indisponible sur mobile (vm/fs) — voir GrammalecteChecker.
    let isMobile = false;
    try {
      const obsidian = await import("obsidian");
      isMobile = !!(obsidian && obsidian.Platform && obsidian.Platform.isMobile);
    } catch {
      isMobile = false;
    }

    if (isMobile) {
      return checkTextLanguageTool(text, languageToolOptions());
    }

    const companion = this.getCompanion();
    if (companion && companion.checkText && (!companion.supportsLang || companion.supportsLang(lang))) {
      return companion.checkText(text, lang, { knownWords, ignoredRules, detectRepetitions });
    }

    if (engine === "auto") {
      // Compagnon absent ou langue non couverte (ex. anglais avant l'intégration
      // Harper) : secours cloud plutôt que de ne rien signaler.
      return checkTextLanguageTool(text, languageToolOptions());
    }

    return [];
  }
}
