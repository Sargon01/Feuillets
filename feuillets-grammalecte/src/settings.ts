/* Réglages du compagnon : trois options, toutes réellement appliquées par
 * Grammalecte. Rien de générique ici (langue d'interface, affichage des
 * résultats, navigation) — tout cela appartient à Feuillets et n'a pas à être
 * dupliqué.
 *
 * Pas de réglage « analyse automatique » : la version 1 n'analyse QUE sur
 * commande explicite. Un tel réglage n'aurait rien à piloter. */

import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";

export type GrammalecteSettings = {
  /** Signaler aussi les mots inconnus du dictionnaire. */
  checkSpelling: boolean;
  /** Règles redon1/redon2 de Grammalecte (répétitions proches), désactivées
   *  par défaut dans Grammalecte lui-même parce qu'elles sont bruyantes. */
  detectRepetitions: boolean;
  /** Suggestions transmises par signalement. 0 = aucune. */
  maxSuggestions: number;
  /** Mots appris par l'utilisateur (persistant dans data.json). */
  learnedWords: string[];
};

export const DEFAULT_SETTINGS: GrammalecteSettings = {
  checkSpelling: true,
  detectRepetitions: false,
  maxSuggestions: 5,
  learnedWords: [],
};

/** Normalise ce qui a été relu depuis data.json : un fichier de réglages
 *  édité à la main ou écrit par une version antérieure ne doit pas produire
 *  un `maxSuggestions` négatif ni un booléen absent. */
export function normalizeSettings(raw: unknown): GrammalecteSettings {
  const data = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<GrammalecteSettings>;
  const max = typeof data.maxSuggestions === "number" && Number.isFinite(data.maxSuggestions)
    ? Math.min(20, Math.max(0, Math.round(data.maxSuggestions)))
    : DEFAULT_SETTINGS.maxSuggestions;
  const learned = Array.isArray(data.learnedWords)
    ? data.learnedWords.filter((w): w is string => typeof w === "string" && w.trim() !== "")
    : DEFAULT_SETTINGS.learnedWords;
  return {
    checkSpelling: typeof data.checkSpelling === "boolean" ? data.checkSpelling : DEFAULT_SETTINGS.checkSpelling,
    detectRepetitions:
      typeof data.detectRepetitions === "boolean" ? data.detectRepetitions : DEFAULT_SETTINGS.detectRepetitions,
    maxSuggestions: max,
    learnedWords: learned,
  };
}

type SettingsHost = Plugin & {
  settings: GrammalecteSettings;
  saveSettings(): Promise<void>;
};

export class GrammalecteSettingTab extends PluginSettingTab {
  private readonly host: SettingsHost;

  constructor(app: App, host: SettingsHost) {
    super(app, host);
    this.host = host;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    /* Dire où passe le texte est un engagement, pas un argument commercial :
       l'analyse s'exécute dans Obsidian, sur des fichiers du coffre. Aucune
       requête réseau n'est faite par ce greffon. */
    containerEl.createEl("p", {
      text:
        "L'analyse est entièrement locale : le texte des feuillets ne quitte jamais " +
        "cet ordinateur. Elle ne se déclenche que sur commande, et ne modifie jamais " +
        "les fichiers analysés.",
    });

    new Setting(containerEl)
      .setName("Signaler les mots inconnus")
      .setDesc("Ajoute la vérification orthographique aux signalements de grammaire.")
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.checkSpelling).onChange(async (value) => {
          this.host.settings.checkSpelling = value;
          await this.host.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Signaler les répétitions proches")
      .setDesc(
        "Active les règles redon1/redon2 de Grammalecte. Désactivées par défaut, y compris " +
          "dans Grammalecte : elles sont bavardes sur un texte littéraire."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.detectRepetitions).onChange(async (value) => {
          this.host.settings.detectRepetitions = value;
          await this.host.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Suggestions par signalement")
      .setDesc("Nombre maximal de corrections proposées (0 pour n'en afficher aucune).")
      .addSlider((slider) =>
        slider
          .setLimits(0, 10, 1)
          .setValue(this.host.settings.maxSuggestions)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.host.settings.maxSuggestions = value;
            await this.host.saveSettings();
          })
      );
  }
}
