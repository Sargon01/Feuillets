/* eslint-disable @typescript-eslint/no-require-imports -- require paresseux volontaire : fs/path ne sont pas disponibles sur mobile, ils ne sont charges qu'a l'ecriture des mots appris */
/* global require -- défini par environnement */
import type { App, PluginManifest } from "obsidian";
import { pluginAbsoluteDir } from "../utils/plugin-dir.js";

type GrammarUserDataSettings = {
  grammalecteKnownWords?: unknown;
  grammalecteIgnoredRules?: unknown;
};

// Mots appris / fautes ignorées de la correction grammaticale : à part de
// data.json (les réglages du plugin, réécrits en entier à chaque
// saveSettings() — une liste qui grossit sans limite dedans devient vite
// coûteuse) et à part de resources/grammalecte|harper (cache re-
// téléchargeable, voir grammar-assets-manager.js — une mise à jour du
// moteur pourrait l'effacer et emporter ces données avec).
export class GrammarUserData {
  app: App;
  manifest: PluginManifest;
  knownWords: string[];
  ignoredRules: string[];

  constructor(app: App, manifest: PluginManifest) {
    this.app = app;
    this.manifest = manifest;
    this.knownWords = [];
    this.ignoredRules = [];
    this.load();
  }

  get filePath(): string {
    const path = require("path");
    return path.join(pluginAbsoluteDir(this.app, this.manifest), "resources", "grammar-user-data.json");
  }

  load(): void {
    const fs = require("fs");
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as { knownWords?: unknown; ignoredRules?: unknown };
      this.knownWords = Array.isArray(data.knownWords) ? data.knownWords as string[] : [];
      this.ignoredRules = Array.isArray(data.ignoredRules) ? data.ignoredRules as string[] : [];
    } catch {
      this.knownWords = [];
      this.ignoredRules = [];
    }
  }

  save(): void {
    const fs = require("fs");
    const path = require("path");
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify({ knownWords: this.knownWords, ignoredRules: this.ignoredRules }, null, 2));
  }

  /** Migration ponctuelle depuis l'ancien stockage (settings.grammalecte
   * KnownWords/IgnoredRules dans data.json) — appelée une fois au
   * démarrage tant que ces clés existent encore côté réglages. */
  migrateFromSettings(settings: GrammarUserDataSettings): boolean {
    const oldWords = Array.isArray(settings.grammalecteKnownWords) ? settings.grammalecteKnownWords as string[] : [];
    const oldRules = Array.isArray(settings.grammalecteIgnoredRules) ? settings.grammalecteIgnoredRules as string[] : [];
    if (oldWords.length === 0 && oldRules.length === 0) return false;

    for (const w of oldWords) {
      if (!this.knownWords.some((k) => k.toLowerCase() === w.toLowerCase())) this.knownWords.push(w);
    }
    for (const r of oldRules) {
      if (!this.ignoredRules.includes(r)) this.ignoredRules.push(r);
    }
    this.save();
    delete settings.grammalecteKnownWords;
    delete settings.grammalecteIgnoredRules;
    return true;
  }

  learnWord(word: string): boolean {
    if (this.knownWords.some((w) => w.toLowerCase() === word.toLowerCase())) return false;
    this.knownWords.push(word);
    this.save();
    return true;
  }

  unlearnWord(word: string): void {
    this.knownWords = this.knownWords.filter((w) => w !== word);
    this.save();
  }

  clearKnownWords(): void {
    this.knownWords = [];
    this.save();
  }

  ignoreIssueSignature(sig: string): boolean {
    if (this.ignoredRules.includes(sig)) return false;
    this.ignoredRules.push(sig);
    this.save();
    return true;
  }

  unignoreSignature(sig: string): void {
    this.ignoredRules = this.ignoredRules.filter((s) => s !== sig);
    this.save();
  }

  clearIgnoredRules(): void {
    this.ignoredRules = [];
    this.save();
  }
}

/* eslint-enable @typescript-eslint/no-require-imports -- fin du bloc require paresseux */
