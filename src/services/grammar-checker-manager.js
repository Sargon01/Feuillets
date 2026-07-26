import { checkTextLanguageTool } from "./languagetool-checker.js";

/**
 * Orchestrateur de vérification linguistique pour Feuillets.
 * Redirige vers les moteurs locaux (Grammalecte FR / Harper EN, aucun appel
 * réseau) ou vers LanguageTool (cloud/local API, multi-langue, sélectionné
 * explicitement ou utilisé en secours sur mobile / langue non couverte).
 */
export class GrammarCheckerManager {
  constructor(app, manifest, grammalecteChecker, harperChecker) {
    this.app = app;
    this.manifest = manifest;
    this.grammalecteChecker = grammalecteChecker;
    this.harperChecker = harperChecker;
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

    // Mode local : Grammalecte FR / Harper EN, aucun appel réseau.
    // Indisponible sur mobile (vm/fs) — voir GrammalecteChecker/HarperChecker.
    let isMobile = false;
    try {
      const obsidian = await import("obsidian");
      isMobile = !!(obsidian && obsidian.Platform && obsidian.Platform.isMobile);
    } catch {
      isMobile = false;
    }

    if (!isMobile) {
      if (lang === "fr" && this.grammalecteChecker) {
        return this.grammalecteChecker.checkText(text, knownWords, ignoredRules, detectRepetitions);
      }
      if (lang === "en" && this.harperChecker) {
        return this.harperChecker.checkText(text, knownWords, ignoredRules);
      }
    }

    if (engine === "auto") {
      // Moteur local absent (mobile, ou pas encore chargé) : secours cloud
      // plutôt que de ne rien signaler.
      return checkTextLanguageTool(text, languageToolOptions());
    }

    return [];
  }
}
