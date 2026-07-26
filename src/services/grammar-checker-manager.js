import { checkTextLanguageTool } from "./languagetool-checker.js";
import { isEngineInstalled } from "./grammar-assets-manager.js";
import { t } from "../i18n/index.js";

/**
 * Orchestrateur de vérification linguistique pour Feuillets.
 * Redirige vers les moteurs locaux (Grammalecte FR / Harper EN, aucun appel
 * réseau) ou vers LanguageTool (cloud/local API, multi-langue, sélectionné
 * explicitement ou utilisé en secours sur mobile / langue non couverte).
 */
export class GrammarCheckerManager {
  constructor(app, manifest, grammalecteChecker, harperChecker, grammarUserData) {
    this.app = app;
    this.manifest = manifest;
    this.grammalecteChecker = grammalecteChecker;
    this.harperChecker = harperChecker;
    this.grammarUserData = grammarUserData;
  }

  async checkText(text, settings, activeLocale = "fr") {
    const engine = settings ? settings.grammarEngine || "grammalecte" : "grammalecte";

    if (engine === "off") {
      return [];
    }

    // Mots appris / fautes ignorées : voir GrammarUserData — stockés à part
    // de data.json, pas dans les réglages.
    const knownWords = this.grammarUserData ? this.grammarUserData.knownWords : [];
    const ignoredRules = this.grammarUserData ? this.grammarUserData.ignoredRules : [];
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

    const localEngine = lang === "fr" ? "grammalecte" : "harper";
    const localReady = !isMobile && isEngineInstalled(this.app, this.manifest, localEngine);

    if (localReady) {
      if (lang === "fr" && this.grammalecteChecker) {
        return this.grammalecteChecker.checkText(text, knownWords, ignoredRules, detectRepetitions);
      }
      if (lang === "en" && this.harperChecker) {
        return this.harperChecker.checkText(text, knownWords, ignoredRules);
      }
    }

    if (engine === "auto") {
      // Moteur local absent (mobile, ou pas encore téléchargé) : secours
      // cloud plutôt que de ne rien signaler.
      return checkTextLanguageTool(text, languageToolOptions());
    }

    // Engine "grammalecte" explicite mais moteur local pas encore installé :
    // message clair plutôt qu'un tableau vide silencieux ou une erreur
    // fs.readFileSync brute — voir GrammarView, qui affiche ce message.
    throw new Error(t("grammar.localEngineNotInstalled"));
  }
}
